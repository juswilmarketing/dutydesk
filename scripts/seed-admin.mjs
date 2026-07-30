const username = process.argv[2] || "admin";
const password = process.argv[3] || "changeme";
const name = process.argv[4] || "Admin";
const role = process.argv[5] || "admin";
const baseUrl = process.env.WORKER_URL || "http://localhost:8787";

console.log(`
Seed admin user via local worker (dev only):

  curl -X POST ${baseUrl}/api/auth/seed \\
    -H "Content-Type: application/json" \\
    -d '{"username":"${username}","password":"${password}","name":"${name}","role":"${role}"}'

Or run: npm run dev:worker
Then POST to /api/auth/seed with the credentials above.
`);
