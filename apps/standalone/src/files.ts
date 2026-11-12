import { Capacitor } from '@capacitor/core';
import type { CadFile } from '@brickwright/cad-editor';
/** The standalone host owns native files; reusable editor packages have no Capacitor dependency. */
export async function download(file: CadFile) {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const folder = `cad-exports/${crypto.randomUUID()}`;
    const name = file.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
    let binary = ''; for (let offset = 0; offset < file.bytes.length; offset += 16384) binary += String.fromCharCode(...file.bytes.subarray(offset, offset + 16384));
    try {
      const output = await Filesystem.writeFile({ directory: Directory.Cache, path: `${folder}/${name}`, data: btoa(binary), recursive: true });
      await Share.share({ title: file.name, files: [output.uri] });
    } finally { await Filesystem.rmdir({ directory: Directory.Cache, path: folder, recursive: true }).catch(() => {}); }
    return;
  }
  const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.mime }));
  const link = document.createElement('a'); link.download = file.name; link.href = url; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
