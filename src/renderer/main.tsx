import { createRoot } from 'react-dom/client';
import { WorkspaceApp } from './workspace-app';

const rootNode = document.getElementById('root');

if (!rootNode) {
  throw new Error('Main renderer root is missing');
}

createRoot(rootNode).render(<WorkspaceApp />);
