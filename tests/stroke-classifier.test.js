import assert from "node:assert/strict";
import test from "node:test";

import { classifySwingTrajectory, PoseTrajectoryBuffer } from "../stroke-classifier.js";

const timestamps = [-500, -350, -250, -120, 0, 100, 200];

function trajectory(wristPoints, oppositeWristY = wristPoints.map(() => 0)) {
    return timestamps.map((timestamp, index) => ({
        timestamp,
        wrist: wristPoints[index],
        elbow: { x: wristPoints[index].x, y: wristPoints[index].y / 2 },
        shoulder: { x: wristPoints[index].x, y: 0 },
        oppositeWrist: { x: -0.5, y: oppositeWristY[index] }
    }));
}

function poseLandmarks(wristX) {
    const landmarks = Array.from({ length: 17 }, () => ({ x: 0.5, y: 0.5 }));
    landmarks[11] = { x: 0.4, y: 0.5 };
    landmarks[12] = { x: 0.6, y: 0.5 };
    landmarks[13] = { x: (wristX + 0.4) / 2, y: 0.5 };
    landmarks[15] = { x: wristX, y: 0.5 };
    landmarks[16] = { x: 1 - wristX, y: 0.5 };
    return landmarks;
}

test("classifies compact, vertical, horizontal, and overhead paths", () => {
    const volley = trajectory(timestamps.map((_, index) => ({ x: 0.4 + index * 0.05, y: 0.05 })));
    const slice = trajectory(timestamps.map((_, index) => ({ x: 0.2 + index * 0.2, y: 0.7 - index * 0.18 })));
    const topspin = trajectory(timestamps.map((_, index) => ({ x: -0.2 - index * 0.2, y: -0.65 + index * 0.18 })));
    const flat = trajectory(timestamps.map((_, index) => ({ x: 0.2 + index * 0.2, y: -0.05 + index * 0.015 })));
    const overhead = timestamps.map((_, index) => ({ x: 0.35 + index * 0.05, y: [0.25, 0.35, 0.48, 0.65, 0.85, 0.55, 0.2][index] }));

    assert.equal(classifySwingTrajectory(volley, 0).strokeType, "Forehand Volley");
    assert.equal(classifySwingTrajectory(slice, 0).strokeType, "Forehand Slice");
    assert.equal(classifySwingTrajectory(topspin, 0).strokeType, "Backhand Topspin");
    assert.equal(classifySwingTrajectory(flat, 0).strokeType, "Forehand Flat Groundstroke");
    assert.equal(classifySwingTrajectory(trajectory(overhead, [-0.4, -0.1, 0.2, 0.5, 0.7, 0.4, 0.1]), 0).strokeType, "Serve");
    assert.equal(classifySwingTrajectory(trajectory(overhead), 0).strokeType, "Smash");
});

test("returns a fallback when pose history is too short", () => {
    const frames = trajectory(timestamps.map((_, index) => ({ x: 0.2 + index * 0.1, y: 0 }))).slice(0, 5);
    assert.equal(classifySwingTrajectory(frames, 0).available, false);
});

test("canonicalizes handedness and front camera mirroring", () => {
    const leftRear = new PoseTrajectoryBuffer();
    const rightFront = new PoseTrajectoryBuffer();

    timestamps.forEach((timestamp, index) => {
        leftRear.addLandmarks(poseLandmarks(0.44 - index * 0.02), true, "rear", timestamp);
        rightFront.addLandmarks(poseLandmarks(0.56 + index * 0.02), false, "front", timestamp);
    });

    assert.equal(leftRear.classify(0).strokeSide, "Forehand");
    assert.equal(rightFront.classify(0).strokeSide, "Forehand");
});
