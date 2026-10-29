import { createRoot } from 'react-dom/client';
import { WorkspaceApp } from './workspace-app';
import { installKeyboardNavigation } from './keyboard-navigation';

const rootNode = document.getElementById('root');

if (!rootNode) {
  throw new Error('Main renderer root is missing');
}

installKeyboardNavigation();
createRoot(rootNode).render(<WorkspaceApp />);
