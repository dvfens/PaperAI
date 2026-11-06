import { AppProvider } from "@/components/app/AppContext";
import { SaathiFlow } from "@/components/app/SaathiFlow";

export default function Home() {
  return (
    <AppProvider persist>
      <SaathiFlow />
    </AppProvider>
  );
}
