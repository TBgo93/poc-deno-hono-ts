import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts"
import { basicAuth, cors, serveStatic } from "https://deno.land/x/hono@v3.11.7/middleware.ts"
import { streamSSE } from "https://deno.land/x/hono@v3.11.7/helper/streaming/index.ts"
import { v5, NAMESPACE_DNS } from "https://deno.land/std@0.209.0/uuid/mod.ts";
import { load } from "https://deno.land/std@0.209.0/dotenv/mod.ts";

// Create Database
const DB = await Deno.openKv();

// Load ENV's
const env = await load()

// APP endpoints
const app = new Hono()

// API endpoints
const api = new Hono().basePath("/api")

api.use(
  '/*',
  (c, next) => {
    const auth = basicAuth({
      username: env["USERNAME"],
      password: env["PASSWORD"]
    })

    return auth(c, next)
  }
)
api.get('/', (c) => c.json({ api: true }))

api.get('/db/get', async (c) => {
  const results = await DB.get(["lastStatus"])
  return c.json({ results })
})
api.notFound((c) => c.json({ message: 'Not Found', ok: false }, 404))
app.route("/", api)

// Events endpoint
app.get('/events', (c) => {
  return streamSSE(c, async (stream) => {
    const encodedUUID = new TextEncoder().encode(crypto.randomUUID())
    const uuid = await v5.generate(NAMESPACE_DNS, encodedUUID)
    
    const watcher = DB.watch([["lastStatus"]])
    
    for await (const entry of watcher) {
      const { value } = entry[0]
      
      if (value !== null) {
        await stream.writeSSE({ data: JSON.stringify(value), event: "send-event", id: uuid })
        await stream.sleep(1000) // delay en milisegundos
      }
    }
  })
})

app.post('/event', async (c) => {
  const body = await c.req.json()
  const { code } = body
  await DB
    .atomic()
    .set(["lastStatus"], { code })
    .commit()
  
  return c.json({ message: "ok" })
})

// HTML & fallback
app.use(cors()) // Middlewares
app.use('/static/*', serveStatic({ root: './' })) // Middlewares

app.get('/', serveStatic({ path: './static/index.html' }))
app.get('*', serveStatic({ path: './static/fallback.txt' }))

Deno.serve({ port: 8443 }, app.fetch)
