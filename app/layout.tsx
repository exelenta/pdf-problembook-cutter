import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '문제집 커터 · PDF를 내 학습지로',
  description: '두 단 PDF에서 문제를 골라 풀이 공간이 있는 A4 문제집으로 만드는 브라우저 도구',
  openGraph: {
    title: '문제집 커터',
    description: 'PDF를 내 학습지로',
    type: 'website',
    locale: 'ko_KR',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '문제집 커터 · PDF를 내 학습지로' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '문제집 커터',
    description: 'PDF를 내 학습지로',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
