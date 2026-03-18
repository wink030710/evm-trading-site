import fs from "fs";
import path from "path";

function getPublicKeysFromDirectory(dirPath: string): string[] {
  try {
    const files = fs.readdirSync(dirPath);
    const publicKeys: string[] = [];

    files.forEach((file) => {
      const filePath = path.join(dirPath, file);
      if (fs.statSync(filePath).isFile()) {
        try {
          const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as { publicKey?: string };
          if (data.publicKey) {
            publicKeys.push(data.publicKey);
          }
        } catch (err) {
          console.error(`Error parsing ${file}:`, (err as Error).message);
        }
      }
    });

    return publicKeys;
  } catch (err) {
    console.error("Error reading directory:", (err as Error).message);
    return [];
  }
}

export { getPublicKeysFromDirectory };

if (require.main === module) {
  const dirPath = process.argv[2] || "/root/.bittensor/wallets/sn86_coldkey2/hotkeys/";
  const publicKeys = getPublicKeysFromDirectory(dirPath);

  const resolved = path.resolve(dirPath);
  const parentDir = path.dirname(resolved);
  const parentName = path.basename(parentDir) || path.basename(resolved);
  const outFile = `${parentName}.json`;
  fs.writeFileSync(outFile, JSON.stringify(publicKeys, null, 2));
}
