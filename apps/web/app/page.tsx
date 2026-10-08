import { redirect } from 'next/navigation';

// Parents land in the admin portal; the kiosk opens /board directly.
export default function Home() {
  redirect('/admin');
}
