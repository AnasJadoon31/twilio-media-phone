import { withAuth } from "next-auth/middleware";

export default withAuth({
  callbacks: {
    authorized: ({ token, req }) => {
      if (req.nextUrl.pathname.startsWith("/dashboard")) {
        return token?.role === "tenant";
      }

      return Boolean(token);
    },
  },
});

export const config = { matcher: ["/dashboard/:path*"] };
