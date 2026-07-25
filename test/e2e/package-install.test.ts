import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const execAsync = promisify(exec);
const REPO_ROOT = path.resolve(__dirname, '../..');
const SAMPLE_FIXTURE = path.resolve(__dirname, '../fixtures/sample.json');

/**
 * Proves the package actually works the way a real consumer will use it:
 * `npm install lottie-render`, `require('lottie-render')`, call it, get a
 * video back — as opposed to the other tests, which import the TypeScript
 * source directly and would miss packaging mistakes (wrong `main`/`files`,
 * templates not shipped, __dirname resolution breaking once nested inside
 * someone else's node_modules, etc).
 */
describe('package installation (npm pack -> npm install -> require)', () => {
  let packDir: string;
  let consumerDir: string;

  beforeAll(async () => {
    // Build first so the packed tarball reflects the current source.
    await execAsync('npm run build', { cwd: REPO_ROOT });

    packDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lottie-render-pack-'));
    const { stdout } = await execAsync(
      `npm pack --pack-destination "${packDir}" --json`,
      { cwd: REPO_ROOT }
    );
    const [{ filename }] = JSON.parse(stdout);
    const tarballPath = path.join(packDir, filename);

    consumerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lottie-render-consumer-'));
    await fs.writeFile(
      path.join(consumerDir, 'package.json'),
      JSON.stringify({ name: 'lottie-render-consumer-test', version: '1.0.0', private: true })
    );

    // A real `npm install`, including the package's own postinstall step —
    // deliberately not using --ignore-scripts, so this matches what an
    // actual `npm install lottie-render` does for a real user. @types/node
    // is installed alongside it because every real Node+TypeScript project
    // has it; without it, Buffer wouldn't resolve for anyone, regardless of
    // this package's own type declarations.
    await execAsync(
      `npm install "${tarballPath}" @types/node --no-audit --no-fund --loglevel=error`,
      { cwd: consumerDir }
    );
  }, 180_000);

  afterAll(async () => {
    if (packDir) await fs.rm(packDir, { recursive: true, force: true });
    if (consumerDir) await fs.rm(consumerDir, { recursive: true, force: true });
  });

  it('renders successfully when required by package name from a separate process', async () => {
    // The renderer logs verbose progress to stdout, so the result is written
    // to its own file rather than parsed out of stdout.
    const resultPath = path.join(consumerDir, 'result.json');
    const runnerScript = `
      const { renderLottie } = require('lottie-render');
      const fs = require('fs');
      (async () => {
        const sample = JSON.parse(fs.readFileSync(${JSON.stringify(SAMPLE_FIXTURE)}, 'utf-8'));
        const result = await renderLottie(sample);
        if (!result.success) {
          console.error('RENDER_FAILED: ' + result.error);
          process.exit(1);
        }
        const isMp4 = result.videoBuffer.length > 12 && result.videoBuffer.toString('ascii', 4, 8) === 'ftyp';
        fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({
          isMp4,
          bufferLength: result.videoBuffer.length,
          hasVideoPath: result.videoPath !== undefined,
        }));
      })().catch((e) => { console.error('ERR: ' + e.stack); process.exit(1); });
    `;
    const runnerPath = path.join(consumerDir, 'run.js');
    await fs.writeFile(runnerPath, runnerScript);

    const beforeEntries = new Set(await fs.readdir(consumerDir));
    await execAsync(`node "${runnerPath}"`, { cwd: consumerDir });

    const output = JSON.parse(await fs.readFile(resultPath, 'utf-8'));
    expect(output.isMp4).toBe(true);
    expect(output.bufferLength).toBeGreaterThan(0);
    expect(output.hasVideoPath).toBe(false);

    // Running the render (with no outputPath) must not leave any *unexpected*
    // files behind in the consumer's own project directory — result.json is
    // this test's own bookkeeping, not something the library created.
    await fs.rm(resultPath);
    const afterEntries = new Set(await fs.readdir(consumerDir));
    const newEntries = [...afterEntries].filter((entry) => !beforeEntries.has(entry));
    expect(newEntries).toEqual([]);
  }, 60_000);

  it('exposes correct, usable TypeScript type declarations', async () => {
    // A plain `require` test proves the JS works, but says nothing about
    // whether dist/index.d.ts actually type-checks for a TS consumer — a
    // wrong `types` field or a broken .d.ts would only show up here.
    const consumerScript = `
      import { renderLottie, RenderOptions, RenderResult, LottieJSON } from 'lottie-render';

      async function run(): Promise<void> {
        const options: RenderOptions = { width: 100, height: 100, maxFrames: 10, headless: true };
        const json: LottieJSON = { v: '5.12.2', fr: 30, ip: 0, op: 10, w: 100, h: 100 };
        const result: RenderResult = await renderLottie(json, options);
        if (result.success && result.videoBuffer) {
          const length: number = result.videoBuffer.length;
          console.log(length);
        }
      }

      run();
    `;
    const consumerScriptPath = path.join(consumerDir, 'consumer.ts');
    await fs.writeFile(consumerScriptPath, consumerScript);

    const tscPath = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsc');
    try {
      await execAsync(
        `"${tscPath}" --noEmit --strict --target es2020 --module commonjs --moduleResolution node --esModuleInterop "${consumerScriptPath}"`,
        { cwd: consumerDir }
      );
    } finally {
      await fs.rm(consumerScriptPath, { force: true });
    }
  }, 60_000);
});
