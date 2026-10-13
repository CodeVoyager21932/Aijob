import type { NativeResumeDocument } from "@aijob/resume-core";
import { afterEach, expect, test, vi } from "vitest";
import { NativePreviewQueue } from "./preview-queue";

function fixture(timeout = 1000) {
  const ports: {
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: (() => void) | null;
  }[] = [];
  const queue = new NativePreviewQueue(() => {
    const port = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null };
    ports.push(port);
    return port;
  }, timeout);
  const render = (signal = new AbortController().signal) =>
    queue.render({} as NativeResumeDocument, [], signal);
  const reply = (index = 0) => {
    const port = ports[index];
    if (!port) throw new Error("Missing worker");
    const request = port.postMessage.mock.calls.at(-1)?.[0];
    port.onmessage?.({
      data: { generation: request.generation, blob: new Blob(["pdf"]), anchors: [] },
    } as MessageEvent);
  };
  return { queue, ports, render, reply };
}
afterEach(() => vi.useRealTimers());

test("serializes candidates with one engine and sends fonts once", async () => {
  const { queue, ports, render, reply } = fixture();
  const results = [render(), render(), render()];
  expect(ports).toHaveLength(1);
  expect(ports[0]?.postMessage).toHaveBeenCalledTimes(1);
  reply();
  await results[0];
  expect(ports[0]?.postMessage).toHaveBeenCalledTimes(2);
  expect(ports[0]?.postMessage.mock.calls[1]?.[0].fonts).toBeUndefined();
  reply();
  await results[1];
  reply();
  await results[2];
  queue.dispose();
});

test("cancels queued work and ignores an abandoned active result without exceeding concurrency", async () => {
  const { queue, ports, render, reply } = fixture();
  const active = new AbortController(),
    pending = new AbortController();
  const first = render(active.signal).catch((error) => error.name);
  const second = render(pending.signal).catch((error) => error.name);
  const third = render();
  active.abort();
  pending.abort();
  expect(await first).toBe("AbortError");
  expect(await second).toBe("AbortError");
  expect(ports[0]?.postMessage).toHaveBeenCalledTimes(1);
  reply();
  expect(ports[0]?.postMessage).toHaveBeenCalledTimes(2);
  reply();
  await third;
  queue.dispose();
});

test("terminates a timed-out engine and allows the next candidate to render", async () => {
  vi.useFakeTimers();
  const { queue, ports, render, reply } = fixture(100);
  const first = render().catch((error) => error.message);
  const second = render();
  await vi.advanceTimersByTimeAsync(100);
  expect(await first).toContain("超过等待时间");
  expect(ports[0]?.terminate).toHaveBeenCalledOnce();
  expect(ports).toHaveLength(2);
  expect(ports[1]?.postMessage.mock.calls[0]?.[0].fonts).toEqual([]);
  reply(1);
  await second;
  queue.dispose();
});

test("late errors from a terminated engine do not reject a newer preview", async () => {
  vi.useFakeTimers();
  const { queue, ports, render, reply } = fixture(100);
  const first = render().catch((error) => error.message);
  const second = render();
  const oldError = ports[0]?.onerror;
  await vi.advanceTimersByTimeAsync(100);
  expect(await first).toContain("超过等待时间");
  oldError?.();
  expect(ports[1]?.terminate).not.toHaveBeenCalled();
  reply(1);
  expect((await second).blob.size).toBeGreaterThan(0);
  queue.dispose();
});
