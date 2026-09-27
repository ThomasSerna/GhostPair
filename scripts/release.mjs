import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Called only by the main push job after CI required succeeds.
export async function publishRelease({ github, repo, version, sha, directory = 'dist/packages' }) {
  assert.match(version, /^\d+\.\d+\.\d+(?:\.\d+)?$/, 'Invalid extension version');
  assert.match(sha, /^[a-f0-9]{40}$/, 'Release requires a full commit SHA');
  const tag = `v${version}`;
  const releases = await github.paginate(github.rest.repos.listReleases, { ...repo, per_page: 100 });
  let release = releases.find(item => item.tag_name === tag);
  if (release && !release.draft) return `${tag} is already published; assets unchanged.`;
  if (release) assert.equal(release.target_commitish, sha, 'Draft belongs to another commit; rerun its original CI or bump the version');

  let object;
  try { object = (await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` })).data.object; }
  catch (error) { if (error.status !== 404) throw error; }
  while (object?.type === 'tag') object = (await github.rest.git.getTag({ ...repo, tag_sha: object.sha })).data.object;
  if (object) assert.equal(object.sha, sha, 'Existing tag does not point to the verified commit');

  // Read both files before creating a draft, so missing artifacts cannot leave a partial release.
  const files = await Promise.all(['chrome', 'edge'].map(async browser => {
    const name = `ghostpair-${browser}-${version}.zip`;
    const data = await readFile(join(directory, name));
    return { name, data, digest: `sha256:${createHash('sha256').update(data).digest('hex')}` };
  }));
  if (!release) {
    release = (await github.rest.repos.createRelease({
      ...repo, tag_name: tag, target_commitish: sha, name: `GhostPair ${version}`,
      draft: true, generate_release_notes: true,
      body: '## Install\n\nDownload the ZIP for Chrome or Edge below (not the source code archives), extract it into a permanent folder, open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.\n\nFor updates, replace the files in that same folder and click **Reload**; do not uninstall if you want to retain saved settings and identity. Update both participants together.\n\nThese packages use https://ghostpair.onrender.com. Store submission remains a separate process.\n',
    })).data;
  }
  for (const file of files) {
    const existing = release.assets.find(asset => asset.name === file.name);
    if (existing?.state === 'uploaded') {
      assert.equal(existing.digest, file.digest, `Draft asset ${file.name} differs from the verified build`);
      continue;
    }
    // GitHub can leave a zero-byte starter asset after an interrupted upload.
    if (existing) await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: existing.id });
    const { data: uploaded } = await github.rest.repos.uploadReleaseAsset({
      ...repo, release_id: release.id, name: file.name, data: file.data,
      headers: { 'content-type': 'application/zip' },
    });
    assert.equal(uploaded.state, 'uploaded', `Upload incomplete: ${file.name}`);
    assert.equal(uploaded.digest, file.digest, `Upload checksum mismatch: ${file.name}`);
  }
  await github.rest.repos.updateRelease({ ...repo, release_id: release.id, draft: false });
  return `Published ${tag} from ${sha} with both verified ZIPs.`;
}
