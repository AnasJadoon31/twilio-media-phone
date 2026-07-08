import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import prisma from "@/lib/prisma";

const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || "superadmin@example.com";
const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || "change-me-now";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        admin: { label: "Admin", type: "text" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        if ((credentials as any).admin === "true") {
          const isSuperAdmin =
            credentials.email.toLowerCase() === superAdminEmail.toLowerCase() &&
            credentials.password === superAdminPassword;

          if (!isSuperAdmin) {
            return null;
          }

          return {
            id: "super-admin",
            email: superAdminEmail,
            name: "Super Admin",
            role: "admin",
          };
        }

        const tenant = await prisma.tenant.findUnique({
          where: { email: credentials.email.toLowerCase() }
        });

        if (!tenant) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(credentials.password, tenant.passwordHash);

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: tenant.id,
          email: tenant.email,
          name: tenant.name,
          slug: tenant.slug,
          role: "tenant",
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.slug = (user as any).slug;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id = token.id;
        (session.user as any).slug = token.slug;
        (session.user as any).role = token.role;
      }
      return session;
    }
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 Days
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET || "super-secret-default-key-change-in-production",
};
