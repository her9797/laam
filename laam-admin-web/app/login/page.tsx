import type { Metadata } from "next";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/LoginForm";
import { LoginHeading } from "@/features/auth/LoginHeading";

export const metadata: Metadata = {
  title: "관리자 로그인 | LAM 관리자",
};

export default function LoginPage() {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh items-center justify-center px-4"
    >
      <Card className="w-full max-w-sm">
        <CardHeader>
          <LoginHeading />
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
