await Promise.all([
  import("./server.js"),
  import("./match-worker.js"),
  import("./collector-worker.js"),
]);
