import assert from "node:assert/strict";
import test from "node:test";

import { getRacketFaceAngle, getRacketFaceState, normalizeAngle } from "../racket-angle.js";

test("normalizes wrapped sensor angles", () => {
    assert.equal(normalizeAngle(270), -90);
    assert.equal(normalizeAngle(-270), 90);
});

test("maps the fixed sensor mount neutral orientation to zero degrees", () => {
    assert.equal(getRacketFaceAngle(90), 0);
    assert.equal(getRacketFaceAngle(-90), 0);
});

test("keeps face-angle polarity independent of stroke classification", () => {
    assert.equal(getRacketFaceAngle(80), 10);
    assert.equal(getRacketFaceAngle(100), -10);
    assert.equal(getRacketFaceAngle(0), 90);
    assert.equal(getRacketFaceAngle(180), -90);
    assert.equal(getRacketFaceState(10), "Open");
    assert.equal(getRacketFaceState(-10), "Closed");
    assert.equal(getRacketFaceState(3), "Neutral");
});

test("does not claim a face angle without a sensor angle", () => {
    assert.equal(getRacketFaceAngle(null), null);
});
