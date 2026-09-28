import assert from "node:assert/strict";
import test from "node:test";

import { normalizeJevState } from "../api/jev.js";
import { classifySwing } from "../jev-service.js";

function fakeResult(index) {
    return {
        answers: {
            stroke_type: {
                choice: index % 2 === 0 ? "forehand_topspin" : "backhand_topspin",
                confidence: 0.91,
                probabilities: { forehand_topspin: 0.91, backhand_topspin: 0.09 }
            },
            is_junk: {
                value: 0.02,
                confidence: 0.98,
                probabilities: { true: 0.02, false: 0.98 }
            },
            quality: {
                score: 2,
                label: "clean",
                confidence: 0.88,
                probabilities: { 0: 0.01, 1: 0.1, 2: 0.88, 3: 0.01 }
            },
            face_advice: {
                choice: "perfect_neutral",
                confidence: 0.86,
                probabilities: { perfect_neutral: 0.86 }
            },
            should_count: {
                value: 0.97,
                confidence: 0.97,
                probabilities: { true: 0.97, false: 0.03 }
            }
        },
        model: "jev-latest",
        input_tokens: 30
    };
}

test("classifies 10 simulated swings with one request at a time", async () => {
    const originalFetch = globalThis.fetch;
    let activeRequests = 0;
    let maximumParallelRequests = 0;
    let requestCount = 0;

    globalThis.fetch = async (_url, options) => {
        const requestIndex = requestCount++;
        const requestBody = JSON.parse(options.body);
        assert.equal(options.method, "POST");
        assert.ok(requestBody.state);

        activeRequests++;
        maximumParallelRequests = Math.max(maximumParallelRequests, activeRequests);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeRequests--;

        return new Response(JSON.stringify(fakeResult(requestIndex)), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    };

    try {
        const swings = Array.from({ length: 10 }, (_, index) => ({
            peakG: 4 + index,
            maxGyro: 200 + index * 20,
            racketSpeed: 10 + index,
            sensorAngle: index % 2 === 0 ? 80 : 100,
            strokeSide: "Forehand",
            trajectoryStrokeType: "Forehand Topspin",
            trajectoryConfidence: 0.85,
            trajectoryFeatures: {
                totalPath: 1.6,
                verticalThroughContact: 0.5,
                horizontalThroughContact: 0.8
            },
            isLefty: false,
            faceAngle: index % 2 === 0 ? 10 : -10,
            hitHistoryTail: []
        }));

        const results = await Promise.all(swings.map(classifySwing));

        assert.equal(results.length, 10);
        assert.equal(requestCount, 10);
        assert.equal(maximumParallelRequests, 1);
        for (const result of results) {
            assert.equal(result.model, "jev-latest");
            assert.equal(result.answers.should_count.value, 0.97);
            assert.equal(result.answers.quality.label, "clean");
            assert.ok(Number.isFinite(result.latency));
            assert.equal(result.input_tokens, 30);
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("folds raw sensor orientation while preserving racket-face direction", () => {
    const commonState = {
        peakG: 10,
        maxGyro: 300,
        racketSpeed: 14,
        strokeSide: "Forehand",
        trajectoryStrokeType: "Forehand Flat Groundstroke",
        trajectoryConfidence: 0.8,
        trajectoryFeatures: {
            totalPath: 1.4,
            verticalThroughContact: 0.05,
            horizontalThroughContact: 0.9
        },
        isLefty: false,
        hitHistoryTail: []
    };

    const openFace = normalizeJevState({ ...commonState, sensorAngle: 80, faceAngle: 10 });
    const closedFace = normalizeJevState({ ...commonState, sensorAngle: -80, faceAngle: -10 });

    assert.equal(openFace.sensorAngle, closedFace.sensorAngle);
    assert.equal(openFace.faceAngle, 10);
    assert.equal(closedFace.faceAngle, -10);
});
