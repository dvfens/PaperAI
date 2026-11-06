import { AppProvider } from "@/components/app/AppContext";
import { MyForms } from "@/components/screens/MyForms";

export const metadata = { title: "My forms — Saathi", robots: { index: false } };

export default function MyFormsPage() {
  return (
    <AppProvider>
      <MyForms />
    </AppProvider>
  );
}
