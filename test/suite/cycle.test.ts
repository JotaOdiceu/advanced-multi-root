import * as assert from 'node:assert';
import { ProjectsProvider } from '../../src/projectsProvider';
import { makeContext } from '../helpers';

function providerWith(ids: string[]): {
  provider: ProjectsProvider;
  calls: string[];
} {
  const ctx = makeContext({
    'tabs.projectTabs': ids.map((id) => ({
      id,
      name: id.toUpperCase(),
      folders: [{ uri: `file:///tmp/${id}` }],
    })),
  });
  const provider = new ProjectsProvider(ctx);
  const calls: string[] = [];
  (provider as any).switchProject = async (id: string) => {
    calls.push(id);
  };
  return { provider, calls };
}

suite('cycleProject(): next / previous navigation', () => {
  test('moves forward and backward from the active tab', async () => {
    const { provider, calls } = providerWith(['a', 'b', 'c']);
    (provider as any).activeTabId = 'b';

    await provider.cycleProject(1);
    await provider.cycleProject(-1);

    assert.deepStrictEqual(calls, ['c', 'a']);
  });

  test('wraps around at both ends', async () => {
    const { provider, calls } = providerWith(['a', 'b', 'c']);

    (provider as any).activeTabId = 'c';
    await provider.cycleProject(1);
    (provider as any).activeTabId = 'a';
    await provider.cycleProject(-1);

    assert.deepStrictEqual(calls, ['a', 'c']);
  });

  test('with no active tab, forward picks the first and backward the last', async () => {
    const { provider, calls } = providerWith(['a', 'b', 'c']);

    await provider.cycleProject(1);
    await provider.cycleProject(-1);

    assert.deepStrictEqual(calls, ['a', 'c']);
  });

  test('is a no-op with fewer than two tabs', async () => {
    const { provider, calls } = providerWith(['only']);
    await provider.cycleProject(1);
    assert.deepStrictEqual(calls, []);
  });
});
