/**
 * 拍照 / 从相册选 / 选 PDF 三个入口背后的系统选择器(第五十四批 P-1)。
 *
 * `expo-image-picker` 与 `expo-document-picker` 已装进官员端(2026-10-27),原生模块要重建 dev client
 * 才进 App(`npm run --workspace mobile-officer ios|android`);只换 JS bundle 的旧 App 会在加载时报缺原生模块。
 */
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

export type Picked = { uri: string; name: string; type: string; size: number };
export type PickKind = "camera" | "library" | "file";

/** 三个入口都在;保留这个函数,入口按它画。 */
export function pickerAvailable(_kind: PickKind): boolean {
  return true;
}

const nameOf = (uri: string, fallback: string) => uri.split("/").pop() || fallback;

/** 取消 = 空数组。权限被拒也当取消(系统已经弹过自己的说明)。 */
export async function pickFiles(kind: PickKind): Promise<Picked[]> {
  if (kind === "file") {
    const r = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return [];
    return r.assets.map((a) => ({ uri: a.uri, name: a.name ?? nameOf(a.uri, "file.pdf"), type: a.mimeType ?? "application/pdf", size: a.size ?? 0 }));
  }
  let r: ImagePicker.ImagePickerResult;
  if (kind === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return [];
    r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"] });
  } else {
    r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true });
  }
  if (r.canceled) return [];
  return r.assets.map((a) => ({ uri: a.uri, name: a.fileName ?? nameOf(a.uri, "photo.jpg"), type: a.mimeType ?? "image/jpeg", size: a.fileSize ?? 0 }));
}
