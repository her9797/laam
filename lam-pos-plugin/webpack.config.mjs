import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname } from "path";
import test from "@tossplace/pos-plugin-test";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default test.createWebpackConfig(require(path.join(__dirname, "package.json")));
