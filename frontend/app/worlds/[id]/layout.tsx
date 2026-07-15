import { demoWorldId } from "@/lib/demoData";

export function generateStaticParams() {
  return [{ id: "new" }, { id: demoWorldId }];
}

export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return children;
}
