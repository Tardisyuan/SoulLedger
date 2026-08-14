/**
 * Lore locks for src/config/workflow-templates.ts.
 *
 * These presets carry mythological facts, and every one of the errors below
 * survived review because the wrong value reads as plausible. The audits that
 * were supposed to catch them locked *role* but never *place* or *order*, so
 * "Osiris judges in the Field of Reeds" passed and reported OK for as long as
 * it existed. This file locks place and order.
 *
 * Sources are in docs/lore-verification/. The two that matter here:
 *   - verify-egyptian.md §2.1-2.3, §3.3, §7 items 11-13
 *     (Budge, *The Book of the Dead: The Papyrus of Ani*, 1895, Plates III-IV;
 *      British Museum Papyrus of Hunefer, BM EA 9901)
 *   - verify-greek.md §2.1-2.2, §三 item 3
 *     (Plato, *Gorgias* 524a; Dante, *Inferno* V.4-15)
 *
 * Each assertion below asserts absence as well as presence: checking that
 * Osiris sits in the Hall is not enough if a second node still puts him in
 * Aaru, and checking that Ammit exists is not enough if she is still ahead of
 * the verdict.
 */

import {
  WORKFLOW_TEMPLATES,
  type WorkflowNodeTemplate,
  type WorkflowTemplate,
} from "@/src/config/workflow-templates";

const HALL = "两真之殿";
const AARU = "芦苇原";

const templates = Object.entries(WORKFLOW_TEMPLATES);

const byCivilization = (civilization: string): [string, WorkflowTemplate][] =>
  templates.filter(([, template]) => template.civilization === civilization);

const nodesNaming = (template: WorkflowTemplate, actor: string): WorkflowNodeTemplate[] =>
  template.nodes.filter((node) => node.name.includes(actor));

const orderOf = (template: WorkflowTemplate, actor: string): number | undefined =>
  nodesNaming(template, actor)[0]?.order;

// ── Egypt: the Hall is the venue, Aaru is the outcome ────────────────

describe("Egyptian templates: Osiris judges in the Hall of Two Truths", () => {
  const egyptian = byCivilization("EGYPTIAN");

  it("covers every Egyptian template, so a sixth one cannot slip past", () => {
    // All five were wrong at once. If a template is added, this count fails
    // and whoever adds it has to decide where its Osiris sits.
    expect(egyptian).toHaveLength(5);
  });

  it.each(egyptian)("%s seats every Osiris node in the Hall", (_key, template) => {
    const osiris = nodesNaming(template, "Osiris");
    expect(osiris.length).toBeGreaterThan(0);
    for (const node of osiris) {
      expect(node.court).toBe(HALL);
    }
  });

  it("puts no node of any Egyptian template in the Field of Reeds", () => {
    // Aaru is where the vindicated go afterwards. A court of 芦苇原 means a
    // judgment step was filed at its own outcome — the original defect.
    const inAaru = egyptian.flatMap(([key, template]) =>
      template.nodes.filter((node) => node.court === AARU).map((node) => `${key}/${node.name}`),
    );
    expect(inAaru).toEqual([]);
  });
});

describe("Egyptian routine: Ammit is the failure branch, not a step before the verdict", () => {
  const routine = WORKFLOW_TEMPLATES.EGYPTIAN_ROUTINE;

  it("places Ammit after Osiris, never before", () => {
    // Budge/Ani p. 258: the Ennead answers Thoth's reading of the verdict with
    // "Let it not be given to the devourer Amemet to prevail over him" — the
    // devouring is a consequence of the verdict, so it cannot precede it.
    const ammit = orderOf(routine, "Ammit");
    const osiris = orderOf(routine, "Osiris");
    expect(ammit).toBeDefined();
    expect(osiris).toBeDefined();
    expect(ammit as number).toBeGreaterThan(osiris as number);
  });

  it("marks every Ammit node as a failure branch rather than a main-flow step", () => {
    // The schema is a flat ordered list with no branch field, so the node type
    // is the only place this fact can live. If it reads like an ordinary step
    // ("吞噬宣判", "地狱分流"), the preset asserts that every soul is devoured.
    const ammitNodes = templates.flatMap(([, template]) => nodesNaming(template, "Ammit"));
    expect(ammitNodes.length).toBeGreaterThan(0);
    for (const node of ammitNodes) {
      expect(node.type).toBe("失败分支");
    }
  });

  it("keeps the forty-two assessors as one aggregate node, ahead of Thoth's reading", () => {
    // One node, not 42: the negative confession is a single passage of the
    // rite and no assessor signs off alone (apps/workflow/services.py holds
    // the same shape). And it precedes the verdict — the soul speaks, then
    // Thoth records and reads out.
    const assessors = routine.nodes.filter((node) => node.name.includes("42审判者"));
    expect(assessors).toHaveLength(1);
    expect(assessors[0].court).toBe(HALL);
    expect(assessors[0].order).toBeLessThan(orderOf(routine, "Thoth") as number);
    // Not an appellate tier: "初审" would make the bench a first instance that
    // some later node reviews, which the rite does not have.
    expect(assessors[0].name).not.toContain("初审");
  });
});

describe("Egyptian trials: Horus escorts, he does not hold a first hearing", () => {
  const trials = WORKFLOW_TEMPLATES.EGYPTIAN_TRIALS;

  it("names no first-instance hearing for Horus anywhere", () => {
    // Budge/Ani Plate IV: Horus takes the already-vindicated Ani by the hand
    // and leads him to Osiris. There is no Horus hearing to be first at.
    const horus = templates.flatMap(([, template]) => nodesNaming(template, "Horus"));
    expect(horus.length).toBeGreaterThan(0);
    for (const node of horus) {
      expect(node.name).not.toContain("初审");
      expect(node.type).not.toBe("初审");
    }
  });

  it("keeps Horus ahead of Osiris, because he leads the dead to him", () => {
    expect(orderOf(trials, "Horus") as number).toBeLessThan(orderOf(trials, "Osiris") as number);
  });
});

// ── Greece: Plato's fork, not a ladder of appeals ────────────────────

describe("Greek template follows Gorgias 524a", () => {
  const greek = WORKFLOW_TEMPLATES.EUROPEAN_GREEK;

  it("gives Minos the final decision, last", () => {
    // "to Minos I will give the privilege of the final decision" — Gorgias
    // 524a. The preset had him at 初审 and Rhadamanthus at 终审, which is the
    // passage exactly inverted.
    const orders = greek.nodes.map((node) => node.order);
    expect(orderOf(greek, "Minos")).toBe(Math.max(...orders));
  });

  it("does not stage Aeacus and Rhadamanthus as an appellate ladder", () => {
    // They try the dead of Europe and of Asia respectively — parallel by
    // origin, not first instance and review. A 初审/复核/终审 chain is the
    // Chinese ten-court shape borrowed onto Plato.
    for (const node of greek.nodes) {
      expect(node.type).not.toBe("初审");
      expect(node.type).not.toBe("复核");
    }
    for (const actor of ["Aeacus", "Rhadamanthus"]) {
      expect(nodesNaming(greek, actor)[0].type).toBe("分区审判");
    }
  });

  it("holds the judgment at the fork in the road, before any punishment", () => {
    // "the meadow at the dividing of the road, whence are the two ways
    // leading, one to the Isles of the Blest, and the other to Tartarus".
    for (const node of greek.nodes) {
      expect(node.court).toBe("岔路口草地");
    }
  });
});

describe("Dante's hell circles: Minos sorts at the second circle", () => {
  const circles = WORKFLOW_TEMPLATES.EUROPEAN_HELL_CIRCLE;

  it("does not classify sins in Limbo", () => {
    // Inferno V.4-15 puts the sorting at the entrance to the second circle.
    // The first circle is Limbo, where nobody is judged or punished.
    const classifier = circles.nodes.find((node) => node.type === "罪行分类");
    expect(classifier).toBeDefined();
    expect(classifier?.court).not.toBe("地狱第一层");
    expect(classifier?.name).toContain("Minos");
  });

  it("does not have Lucifer pronouncing sentence", () => {
    // Lucifer is frozen in Judecca chewing traitors (Inferno XXXIV). Passing
    // sentence is Minos' function, and it happens 33 cantos earlier.
    const lucifer = circles.nodes.find((node) => node.name.includes("Lucifer"));
    expect(lucifer).toBeDefined();
    expect(lucifer?.name).not.toContain("宣判");
  });
});
