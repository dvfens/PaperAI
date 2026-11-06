import { AppProvider } from "@/components/app/AppContext";
import { SharedDocument } from "@/components/screens/SharedDocument";

export const metadata = { title: "Shared document — Saathi", robots: { index: false } };

export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AppProvider>
      <SharedDocument token={token} />
    </AppProvider>
  );
}
