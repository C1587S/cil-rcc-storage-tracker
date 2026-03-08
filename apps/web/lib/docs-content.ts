// Docs content imported as raw strings via webpack asset/source
// During Docker build, these files are at ./docs-content/
// During local dev, they're at ../../docs/
// The webpack config in next.config.js handles .mdx as raw strings

import architecture from '../../docs/architecture.mdx';
import database from '../../docs/database.mdx';
import queryConsole from '../../docs/query-console.mdx';
import treeExplorer from '../../docs/tree-explorer.mdx';
import voronoi from '../../docs/voronoi.mdx';
import examples from '../../docs/examples.mdx';
import deployment from '../../docs/deployment.mdx';

export interface DocSection {
  id: string;
  title: string;
  content: string;
}

export const DOC_SECTIONS: DocSection[] = [
  { id: 'architecture', title: 'Overview', content: architecture },
  { id: 'database', title: 'Database', content: database },
  { id: 'query-console', title: 'Query Console', content: queryConsole },
  { id: 'tree-explorer', title: 'Tree Explorer', content: treeExplorer },
  { id: 'voronoi', title: 'Voronoi Treemap', content: voronoi },
  { id: 'examples', title: 'Examples', content: examples },
  { id: 'deployment', title: 'Deployment', content: deployment },
];
