import assert from "node:assert/strict";
import test from "node:test";
import { getTravelOptions } from "../app/api/travel-options/route.ts";

function place(name, longitude, latitude, cityCode = "029") {
  return { name, longitude, latitude, cityCode, adcode: "610100" };
}

test("同城近郊不能出现飞机或铁路选项", () => {
  const result = getTravelOptions(
    place("灞桥区", 109.064, 34.273),
    place("终南山西五台", 108.828, 34.032),
  );
  assert.deepEqual(result.options, ["公共交通", "打车", "自驾"]);
  assert.doesNotMatch(result.options.join("、"), /飞机|高铁|普通火车/);
});

test("短途跨城优先显示地面交通而非飞机", () => {
  const result = getTravelOptions(
    place("西安", 108.94, 34.34, "029"),
    place("宝鸡", 107.24, 34.36, "0917"),
  );
  assert.ok(result.options.includes("高铁"));
  assert.ok(!result.options.includes("飞机"));
});

test("远距离跨城才提供飞机选项", () => {
  const result = getTravelOptions(
    place("西安", 108.94, 34.34, "029"),
    place("上海", 121.47, 31.23, "021"),
  );
  assert.ok(result.options.includes("飞机"));
  assert.ok(result.distanceKm > 800);
});
