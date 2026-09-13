import { redirect } from 'next/navigation';

// The quickstart's 1:1 demo landing page is replaced by the classroom join
// flow. The original component is kept in components/LandingPage.tsx as a
// working reference for the Agora wiring it demonstrates.
export default function Home() {
  redirect('/join');
}
