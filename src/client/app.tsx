import { useEffect, useState } from 'react';
import { AnswerPage } from '@/client/pages/answer-page.js';
import { CommitPage } from '@/client/pages/commit-page.js';
import { FilePage } from '@/client/pages/file-page.js';
import { ReviewWithComments } from '@/client/pages/review-with-comments.js';
import { useReview } from '@/client/store/review.js';

function usePath(): string {
  const [p, setP] = useState(location.pathname);
  useEffect(() => {
    const on = () => setP(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return p;
}

export function App() {
  const init = useReview((s) => s.init);
  const path = usePath();
  useEffect(() => init(), [init]);
  if (path.startsWith('/file/')) return <FilePage pathname={path} />;
  if (path.startsWith('/answer/'))
    return <AnswerPage id={path.slice('/answer/'.length)} />;
  if (path.startsWith('/commit/'))
    return <CommitPage sha={path.slice('/commit/'.length)} />;
  return <ReviewWithComments />;
}
