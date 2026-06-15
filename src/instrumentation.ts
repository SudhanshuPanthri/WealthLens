/**
 * Runs once when the Next.js server boots. Next.js calls register() in BOTH the
 * Node.js and Edge runtimes, so the Node-only startup work (node:dns + the
 * background refresh timer) lives in ./instrumentation-node and is imported
 * dynamically only under the nodejs runtime — otherwise the Edge bundle fails
 * to compile on the forbidden `node:dns` import.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { start } = await import("./instrumentation-node");
    start();
  }
}
