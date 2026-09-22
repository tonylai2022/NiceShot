const MAX_PARALLEL_REQUESTS = 8;
const RETRYABLE_STATUSES = new Set([429, 529]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

let activeRequests = 0;
const pendingRequests = [];

function waitForSlot() {
    if (activeRequests < MAX_PARALLEL_REQUESTS) {
        activeRequests++;
        return Promise.resolve();
    }

    return new Promise((resolve) => pendingRequests.push(resolve));
}

function releaseSlot() {
    const next = pendingRequests.shift();
    if (next) {
        next();
    } else {
        activeRequests--;
    }
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isOffline() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
}

export async function classifySwing(state) {
    if (isOffline()) throw new Error("JEV unavailable while offline");

    await waitForSlot();
    const startedAt = performance.now();

    try {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const response = await fetch("/api/jev", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ state })
            });

            if (response.ok) {
                const result = await response.json();
                return {
                    ...result,
                    latency: Math.round(performance.now() - startedAt)
                };
            }

            if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_RETRIES) {
                throw new Error(`JEV request failed with status ${response.status}`);
            }

            await wait(BASE_BACKOFF_MS * (2 ** attempt));
        }
    } finally {
        releaseSlot();
    }

    throw new Error("JEV request failed");
}
