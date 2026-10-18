'use client';

export default function CheckoutButton() {
  async function checkout() {
    const res = await fetch('/api/checkout', { method: 'POST' });
    const { url } = await res.json();
    window.location.href = url;
  }

  return <button onClick={checkout}>Upgrade</button>;
}
