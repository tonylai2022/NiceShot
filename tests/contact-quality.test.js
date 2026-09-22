import assert from "node:assert/strict";
import test from "node:test";

import { ContactQualityTracker } from "../contact-quality.js";

const cleanContact = {
    peakG: 10,
    maxGyro: 400,
    torsionKick: 30,
    vibrationLevel: 0.2,
    decayMs: 20
};

const offCenterContact = {
    peakG: 10,
    maxGyro: 400,
    torsionKick: 300,
    vibrationLevel: 1.5,
    decayMs: 110
};

test("scores cleaner contact above twisting and vibrating contact", () => {
    const cleanTracker = new ContactQualityTracker();
    const offCenterTracker = new ContactQualityTracker();

    const clean = cleanTracker.evaluate(cleanContact);
    const offCenter = offCenterTracker.evaluate(offCenterContact);

    assert.equal(clean.label, "Centered");
    assert.equal(offCenter.label, "Off Center");
    assert.ok(clean.score > offCenter.score);
});

test("learns a session baseline after five contacts", () => {
    const tracker = new ContactQualityTracker();
    let result;

    for (let index = 0; index < 5; index++) {
        result = tracker.evaluate({
            ...cleanContact,
            torsionKick: cleanContact.torsionKick + index * 5
        });
    }

    assert.equal(result.baselineProgress, 1);
    assert.equal(result.confidence, 0.9);
});

test("reduces confidence when the accelerometer clips", () => {
    const normalTracker = new ContactQualityTracker();
    const clippedTracker = new ContactQualityTracker();

    const normal = normalTracker.evaluate(cleanContact);
    const clipped = clippedTracker.evaluate({ ...cleanContact, peakG: 16 });

    assert.equal(clipped.saturated, true);
    assert.ok(clipped.confidence < normal.confidence);
});

test("reports unavailable for legacy packets without waveform features", () => {
    const tracker = new ContactQualityTracker();
    const result = tracker.evaluate({ peakG: 8, maxGyro: 300 });

    assert.equal(result.available, false);
    assert.equal(result.label, "Update firmware");
});
