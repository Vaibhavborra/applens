/// <reference lib="webworker" />
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

/**
 * Runs WebLLM inference off the main thread. WebLLM ships its own typed
 * request/response protocol between WebWorkerMLCEngine and this handler.
 */
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
