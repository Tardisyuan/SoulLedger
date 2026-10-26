/**
 * 拍照 / 从相册选 / 选 PDF 三个入口背后的系统选择器(第五十四批 P-1)。
 *
 * 官员端的 package.json 目前没有 `expo-image-picker` / `expo-document-picker`(前者只在灵魂端装着)。
 * 这里按需加载,加载不了(原生模块没编进这个 App)就报「不可用」,入口不画 -- 而不是点了崩。
 * 装上这两个依赖并重建 dev client 之后,这个文件不用改。
 */
export type Picked = { uri: string; name: string; type: string; size: number };
export type PickKind = "camera" | "library" | "file";

type Loaded = { image: any | null; doc: any | null };
let cache: Loaded | null = null;

function modules(): Loaded {
  if (cache) return cache;
  let image: any = null;
  let doc: any = null;
  try {
    image = require("expo-image-picker");
  } catch {
    image = null;
  }
  try {
    doc = require("expo-document-picker");
  } catch {
    doc = null;
  }
  cache = { image, doc };
  return cache;
}

/** 测试用:清掉加载缓存。 */
export const resetPickerCache = () => {
  cache = null;
};

export function pickerAvailable(kind: PickKind): boolean {
  const m = modules();
  return kind === "file" ? !!m.doc : !!m.image;
}

const nameOf = (uri: string, fallback: string) => uri.split("/").pop() || fallback;

/** 取消 = 空数组。权限被拒也当取消(系统已经弹过自己的说明)。 */
export async function pickFiles(kind: PickKind): Promise<Picked[]> {
  const m = modules();
  if (kind === "file") {
    if (!m.doc) return [];
    const r = await m.doc.getDocumentAsync({ type: "application/pdf", multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return [];
    return (r.assets ?? []).map((a: any) => ({ uri: a.uri, name: a.name ?? nameOf(a.uri, "file.pdf"), type: a.mimeType ?? "application/pdf", size: a.size ?? 0 }));
  }
  if (!m.image) return [];
  let r: any;
  if (kind === "camera") {
    const perm = await m.image.requestCameraPermissionsAsync();
    if (!perm.granted) return [];
    r = await m.image.launchCameraAsync({ mediaTypes: ["images"] });
  } else {
    r = await m.image.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true });
  }
  if (r.canceled) return [];
  return (r.assets ?? []).map((a: any) => ({ uri: a.uri, name: a.fileName ?? nameOf(a.uri, "photo.jpg"), type: a.mimeType ?? "image/jpeg", size: a.fileSize ?? 0 }));
}
