import { describe, expect, it, vi } from "vitest";
import { notePlannerActivity, onPlannerActivity } from "./plannerActivity";

describe("planner activity", () => {
  it("reaches every listener until it unsubscribes", () => {
    const one = vi.fn();
    const two = vi.fn();
    const stopOne = onPlannerActivity(one);
    const stopTwo = onPlannerActivity(two);
    notePlannerActivity();
    stopOne();
    notePlannerActivity();
    stopTwo();
    notePlannerActivity();
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(2);
  });

  it("hands on the plan reader, unread", () => {
    const heard = vi.fn();
    const plan = vi.fn(() => "{}");
    const stop = onPlannerActivity(heard);
    notePlannerActivity(plan);
    stop();
    expect(heard).toHaveBeenCalledWith(plan);
    expect(plan).not.toHaveBeenCalled();
  });
});
