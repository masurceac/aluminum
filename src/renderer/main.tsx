import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { PreloadError } from '@/components/preload-error';
import { bridge } from '@/lib/api';

const container = document.getElementById('root');
if (container) createRoot(container).render(bridge ? <App /> : <PreloadError />);
