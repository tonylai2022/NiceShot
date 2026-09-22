import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";

const MAX_PARALLEL_REQUESTS = 8;
let activeRequests = 0;
const pendingRequests = [];

const QUESTIONS = Object.freeze({
    stroke_type: choice("Classify the tennis stroke. Treat state.strokeSide from MediaPipe as authoritative for forehand versus backhand. Sensor angles are folded so flipping the racket sensor side does not change stroke identity.", {
        forehand_topspin: "Forehand with topspin or drive motion; choose only when strokeSide is Forehand.",
        forehand_slice: "Forehand slice; choose only when strokeSide is Forehand.",
        backhand_drive: "Backhand drive or topspin; choose only when strokeSide is Backhand.",
        backhand_slice: "Backhand slice; choose only when strokeSide is Backhand.",
        serve: "Overhead service motion.",
        smash: "Overhead attacking smash that is not a serve."
    }),
    is_junk: noul("Is this motion noise rather than a real tennis swing?", {
        true: "bump/drop/walking not a swing",
        false: "real tennis swing"
    }),
    quality: score("Rate the contact quality.", ["mishit", "ok", "clean", "pro-level"]),
    face_advice: choice("Choose the clearest racket-face coaching advice.", {
        too_open_slice: null,
        too_closed_topspin: null,
        perfect_neutral: null,
        close_3deg_for_spin: null
    }),
    should_count: noul("Should this motion be logged as a tennis hit?", {
        true: "worth logging as hit",
        false: "noise"
    })
});

function acquireSlot() {
    if (activeRequests < MAX_PARALLEL_REQUESTS) {
        activeRequests++;
        return Promise.resolve();
    }
    return new Promise((resolve) => pendingRequests.push(resolve));
}

function releaseSlot() {
    const next = pendingRequests.shift();
    if (next) next();
    else activeRequests--;
}

function normalizeNoul(answer) {
    return {
        value: answer.noul,
        confidence: Math.max(answer.noul, 1 - answer.noul),
        probabilities: { true: answer.noul, false: 1 - answer.noul }
    };
}

function normalizeChoice(answer) {
    return {
        choice: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities
    };
}

function normalizeScore(answer) {
    const scoreIndex = Math.max(0, Math.min(3, Math.round(answer.score)));
    return {
        score: answer.score,
        label: ["mishit", "ok", "clean", "pro-level"][scoreIndex],
        confidence: answer.confidence,
        probabilities: answer.probabilities
    };
}

export function normalizeJevState(state) {
    return {
        ...state,
        sensorAngle: Number.isFinite(state.sensorAngle) ? Math.abs(state.sensorAngle) : null,
        faceAngle: Number.isFinite(state.faceAngle) ? Math.abs(state.faceAngle) : null
    };
}

export default async function handler(request, response) {
    if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        return response.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.TYPESAFE_API_KEY) {
        return response.status(503).json({ error: "JEV is not configured" });
    }

    const state = request.body?.state;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
        return response.status(400).json({ error: "A state object is required" });
    }

    await acquireSlot();
    const startedAt = performance.now();

    try {
        const safeState = normalizeJevState(state);
        const client = new TypeSafeClient({
            apiKey: process.env.TYPESAFE_API_KEY,
            baseURL: "https://api.typesafe.ai",
            defaultModel: "jev-latest",
            retry: {
                maxRetries: 3,
                backoffInitialMs: 500,
                backoffMaxMs: 4000,
                httpStatuses: new Set([408, 429, 500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 529])
            }
        });
        const result = await client.systemOne({
            model: "jev-latest",
            state: safeState,
            questions: QUESTIONS
        });

        return response.status(200).json({
            answers: {
                stroke_type: normalizeChoice(result.answers.stroke_type),
                is_junk: normalizeNoul(result.answers.is_junk),
                quality: normalizeScore(result.answers.quality),
                face_advice: normalizeChoice(result.answers.face_advice),
                should_count: normalizeNoul(result.answers.should_count)
            },
            model: result.model,
            latency: Math.round(performance.now() - startedAt),
            input_tokens: result.usage.input_tokens
        });
    } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 502;
        return response.status(status).json({ error: "JEV classification failed" });
    } finally {
        releaseSlot();
    }
}
