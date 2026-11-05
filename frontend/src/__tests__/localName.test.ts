/** Reference names: English from the row's own column, the source when it has none, and lookups never see the English. */
import { courtLabel } from "@soulledger/core/domain/courts";
import { localName, localNodeName } from "@soulledger/core/domain/localName";
import { hideTheWheel, type SidebarMenu } from "@/src/hooks/useSidebarMenus";
import { menuGlossParts, menuTranslationKey } from "@/src/lib/menuI18n";

jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: null }) }));

describe("localName", () => {
  it("reads the English column for an English reader", () => {
    expect(localName({ name: "第一殿", name_en: "First Court" }, "en")).toBe("First Court");
    expect(localName({ description: "说明", description_en: "Notes" }, "en", "description")).toBe("Notes");
  });

  it("falls back to the source when a new record has no English", () => {
    expect(localName({ name: "新机构", name_en: "" }, "en")).toBe("新机构");
    expect(localName({ name: "旧响应" }, "en")).toBe("旧响应");
  });

  it("gives every other language the source, not the English", () => {
    for (const locale of ["zh-Hans", "egy", undefined]) {
      expect(localName({ name: "第一殿", name_en: "First Court" }, locale)).toBe("第一殿");
    }
  });

  it("keeps a renamed record's English until someone edits it", () => {
    const renamed = { name: "改过的名字", name_en: "First Court" };
    expect(localName(renamed, "en")).toBe("First Court");
    expect(localName(renamed, "zh-Hans")).toBe("改过的名字");
  });

  it("has nothing to say about nothing", () => {
    expect(localName(null, "en")).toBe("");
    expect(localName(undefined, "en")).toBe("");
    expect(localName({ name: 3 }, "en")).toBe("");
  });
});

describe("localNodeName", () => {
  it("reads a built node's column and a template node's JSON key", () => {
    expect(localNodeName({ node_name: "终审", node_name_en: "Final review" }, "en")).toBe("Final review");
    expect(localNodeName({ node_name: "终审", name_en: "Final review" }, "en")).toBe("Final review");
  });

  it("falls back to the source", () => {
    expect(localNodeName({ node_name: "新节点", node_name_en: "" }, "en")).toBe("新节点");
    expect(localNodeName({ node_name: "终审", name_en: "Final review" }, "zh-Hans")).toBe("终审");
    expect(localNodeName(null, "en")).toBe("");
  });
});

describe("lookups keep using the source field", () => {
  const t = (key: string) => key;

  it("a menu group is still found by its source name when it has English", () => {
    const wheel = { id: 1, name: "轮回", name_en: "Rebirth", path: "", menu_type: "DIRECTORY", children: [] } as unknown as SidebarMenu;
    const souls = { id: 2, name: "灵魂业务", name_en: "Soul Operations", path: "", menu_type: "DIRECTORY", children: [] } as unknown as SidebarMenu;
    expect(hideTheWheel([wheel, souls], "EUROPEAN").map((m) => m.name)).toEqual(["灵魂业务"]);
    expect(menuTranslationKey({ name: "轮回", name_en: "Rebirth", path: "", menu_type: "DIRECTORY" })).toBe("breadcrumb.menu.group_rebirth");
  });

  it("courtLabel reads the stored spelling, so a court needs no column", () => {
    const pack = (key: string) => (key === "workflow.court.court_1" ? "First Court" : key);
    expect(courtLabel(pack, "第一殿", "en")).toBe("First Court");
    expect(courtLabel(pack, "一个管理员写的殿", "en")).toBe("一个管理员写的殿");
  });

  it("a menu's own English wins for an English reader, and a menu with none still gets its pack key or its name", () => {
    const pack = (key: string) => (key === "breadcrumb.menu.souls" ? "Soul Management" : key);
    const glossed = (name: string, path: string, name_en?: string) =>
      menuGlossParts({ name, path, name_en, menu_type: "MENU" }, "en", pack).primary;
    expect(glossed("新页面", "/new-page", "New page")).toBe("New page");
    expect(glossed("灵魂管理", "/souls")).toBe("Soul Management");
    expect(glossed("新页面", "/new-page")).toBe("新页面");
    expect(menuGlossParts({ name: "新页面", path: "/new-page", name_en: "New page", menu_type: "MENU" }, "zh-Hans", t).primary).toBe("新页面");
  });
});
