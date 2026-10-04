// Run: npx tsx tests/route.test.ts   (hash route parsing and building)
import assert from "node:assert/strict";
import { parseRoute, routeHash } from "../src/lib/route";

assert.deepEqual(parseRoute(""), { name: "search" });
assert.deepEqual(parseRoute("#/"), { name: "search" });
assert.deepEqual(parseRoute("#/nope"), { name: "search" });
assert.deepEqual(parseRoute("#/settings"), { name: "settings" });
assert.deepEqual(parseRoute("#/settings/"), { name: "settings" });
assert.deepEqual(parseRoute("#/settings/x"), { name: "search" });
assert.deepEqual(parseRoute("#/profiles"), { name: "profiles" });
assert.deepEqual(parseRoute("#/show/169"), { name: "show", showId: 169 });
assert.deepEqual(parseRoute("#/show/169/"), { name: "show", showId: 169 });
assert.deepEqual(parseRoute("#/show/169?s=2&e=4"), { name: "show", showId: 169, position: { season: 2, episode: 4 } });
// Bad ids go to search; bad or partial positions are dropped so saved progress can fill in.
assert.deepEqual(parseRoute("#/show/abc"), { name: "search" });
assert.deepEqual(parseRoute("#/show/0"), { name: "search" });
assert.deepEqual(parseRoute("#/show/1.5"), { name: "search" });
assert.deepEqual(parseRoute("#/show/169?s=2"), { name: "show", showId: 169 });
assert.deepEqual(parseRoute("#/show/169?s=0&e=1"), { name: "show", showId: 169 });
assert.deepEqual(parseRoute("#/show/169?s=x&e=1"), { name: "show", showId: 169 });

assert.equal(routeHash({ name: "search" }), "#/");
assert.equal(routeHash({ name: "settings" }), "#/settings");
assert.equal(routeHash({ name: "profiles" }), "#/profiles");
assert.equal(routeHash({ name: "show", showId: 169 }), "#/show/169");
for (const hash of ["#/", "#/settings", "#/profiles", "#/show/169", "#/show/169?s=2&e=4"]) assert.equal(routeHash(parseRoute(hash)), hash);
console.log("route tests passed");
