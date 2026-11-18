import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('挂载点 #root 不存在');
}

createRoot(container).render(
  <StrictMode>
    <main>
      <h1>Howl</h1>
      <p>对局准备中。</p>
    </main>
  </StrictMode>,
);
