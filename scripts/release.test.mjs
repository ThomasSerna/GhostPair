import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { publishRelease } from './release.mjs';

test('CI required rejects every result except success', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const code = workflow.match(/node -e "(process\.exit\(process\.env\.VERIFY_RESULT[^\n]+)"/)[1];
  for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
    const child = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, VERIFY_RESULT: result }, windowsHide: true });
    assert.equal(child.status, result === 'success' ? 0 : 1, result);
  }
});

test('release publication is versioned, bound to its commit and safe to retry', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ghostpair-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const version = '0.5.0', sha = 'a'.repeat(40), repo = { owner: 'test', repo: 'ghostpair' };
  for (const browser of ['chrome', 'edge']) await writeFile(join(directory, `ghostpair-${browser}-${version}.zip`), `synthetic ${browser} package`);
  function fake({ releases = [], ref, failEdge = false, lookupError } = {}) {
    const calls = [];
    const github = {
      calls, releases,
      paginate: async () => { if (lookupError) throw lookupError; return releases; },
      rest: {
        git: {
          getRef: async () => { if (!ref) throw { status: 404 }; return { data: { object: ref } }; },
          getTag: async () => ({ data: { object: { type: 'commit', sha } } }),
        },
        repos: {
          listReleases() {},
          createRelease: async options => {
            calls.push(['create', options]);
            const release = { ...options, id: 1, assets: [] };
            releases.unshift(release);
            return { data: release };
          },
          uploadReleaseAsset: async options => {
            calls.push(['upload', options.name]);
            if (failEdge && options.name.includes('-edge-')) { failEdge = false; throw new Error('Upload interrupted'); }
            const asset = { id: releases[0].assets.length + 1, name: options.name, state: 'uploaded', digest: `sha256:${createHash('sha256').update(options.data).digest('hex')}` };
            releases[0].assets.push(asset);
            return { data: asset };
          },
          deleteReleaseAsset: async options => {
            calls.push(['delete', options.asset_id]);
            releases[0].assets = releases[0].assets.filter(asset => asset.id !== options.asset_id);
          },
          updateRelease: async options => {
            calls.push(['publish']);
            assert.equal(releases[0].assets.length, 2);
            releases[0].draft = options.draft;
          },
        },
      },
    };
    return github;
  }
  const publish = github => publishRelease({ github, repo, version, sha, directory });

  await t.test('first release, next commit unchanged, then new version', async () => {
    const github = fake();
    await publish(github);
    assert.deepEqual(github.calls.map(call => call[0]), ['create', 'upload', 'upload', 'publish']);
    assert.equal(github.releases[0].target_commitish, sha);
    assert.equal(github.releases[0].tag_name, 'v0.5.0');
    assert.equal(github.releases[0].generate_release_notes, true);
    assert.match(github.releases[0].body, /Load unpacked/);
    const before = JSON.stringify(github.releases);
    await publishRelease({ github, repo, version, sha: 'b'.repeat(40), directory });
    assert.equal(github.calls.length, 4);
    assert.equal(JSON.stringify(github.releases), before);
    for (const browser of ['chrome', 'edge']) await writeFile(join(directory, `ghostpair-${browser}-0.5.1.zip`), 'next version');
    const next = fake({ releases: [structuredClone(github.releases[0])] });
    await publishRelease({ github: next, repo, version: '0.5.1', sha, directory });
    assert.equal(next.releases[0].tag_name, 'v0.5.1');
    assert.equal(next.releases[1].tag_name, 'v0.5.0');
  });
  await t.test('interrupted draft resumes without uploading the completed asset again', async () => {
    const github = fake({ failEdge: true });
    await assert.rejects(publish(github), /Upload interrupted/);
    assert.equal(github.releases[0].draft, true);
    await publish(github);
    assert.equal(github.calls.filter(call => call[0] === 'create').length, 1);
    assert.equal(github.calls.filter(call => call[0] === 'upload' && call[1].includes('-chrome-')).length, 1);
    assert.equal(github.releases[0].draft, false);
  });
  await t.test('draft or tag belonging to another SHA is rejected', async () => {
    const draft = fake({ releases: [{ tag_name: 'v0.5.0', draft: true, target_commitish: 'b'.repeat(40) }] });
    await assert.rejects(publish(draft), /Draft belongs/);
    const tag = fake({ ref: { type: 'commit', sha: 'b'.repeat(40) } });
    await assert.rejects(publish(tag), /Existing tag/);
    assert.equal(draft.calls.length + tag.calls.length, 0);
  });
  await t.test('annotated tags are resolved to the verified commit', async () => {
    const github = fake({ ref: { type: 'tag', sha: 'c'.repeat(40) } });
    await publish(github);
    assert.equal(github.releases[0].draft, false);
  });
  await t.test('starter uploads are replaced only while the release is a draft', async () => {
    const github = fake({ releases: [{ id: 1, tag_name: 'v0.5.0', draft: true, target_commitish: sha, assets: [{ id: 9, name: 'ghostpair-chrome-0.5.0.zip', state: 'starter' }] }] });
    await publish(github);
    assert.deepEqual(github.calls[0], ['delete', 9]);
  });
  await t.test('checksum mismatch, missing artifact and API errors do not publish', async () => {
    const github = fake({ releases: [{ id: 1, tag_name: 'v0.5.0', draft: true, target_commitish: sha, assets: [{ name: 'ghostpair-chrome-0.5.0.zip', state: 'uploaded', digest: 'wrong' }] }] });
    await assert.rejects(publish(github), /differs from/);
    assert.equal(github.calls.length, 0);
    const missing = fake();
    await assert.rejects(publishRelease({ github: missing, repo, version: '0.6.0', sha, directory }), /ENOENT/);
    assert.equal(missing.calls.length, 0);
    const denied = fake({ lookupError: new Error('API denied') });
    await assert.rejects(publish(denied), /API denied/);
    assert.equal(denied.calls.length, 0);
  });
});
