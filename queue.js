// queue.js
// Basit in-memory job queue + worker. Production'da Redis/BullMQ'ya geçilebilir.

const jobs = [];
let processing = false;

function enqueue(job) {
  jobs.push({ id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...job });
  setImmediate(process);
}

async function process() {
  if (processing || !jobs.length) return;
  processing = true;
  while (jobs.length) {
    const job = jobs.shift();
    try {
      await handle(job);
    } catch (e) {
      console.error('[queue] job failed', job.type, e.message);
    }
  }
  processing = false;
}

let handlers = {};
function register(type, fn) { handlers[type] = fn; }

async function handle(job) {
  const fn = handlers[job.type];
  if (!fn) return console.warn('[queue] no handler', job.type);
  await fn(job.data);
}

module.exports = { enqueue, register };
