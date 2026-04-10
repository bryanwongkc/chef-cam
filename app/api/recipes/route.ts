import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const COLLECTION = "recipes";

type RecipeDocument = {
  deviceId?: string;
  name?: string;
  recipe?: unknown;
  createdAt?: number;
  updatedAt?: number;
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId")?.trim();
    if (!deviceId) return badRequest("Missing deviceId");

    const snapshot = await getAdminDb()
      .collection(COLLECTION)
      .where("deviceId", "==", deviceId)
      .get();

    const items = snapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as RecipeDocument) }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return NextResponse.json({ items });
  } catch (error) {
    console.error("GET /api/recipes error:", error);
    return NextResponse.json({ error: "Failed to load recipes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const deviceId = String(body?.deviceId || "").trim();
    const recipe = body?.recipe;
    const name = String(body?.name || "").trim();

    if (!deviceId) return badRequest("Missing deviceId");
    if (!recipe || typeof recipe !== "object") return badRequest("Missing recipe");

    const now = Date.now();
    const ref = await getAdminDb().collection(COLLECTION).add({
      deviceId,
      name: name || recipe.dishName || "Saved Recipe",
      recipe,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id });
  } catch (error) {
    console.error("POST /api/recipes error:", error);
    return NextResponse.json({ error: "Failed to save recipe" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body?.id || "").trim();
    const deviceId = String(body?.deviceId || "").trim();
    const name = String(body?.name || "").trim();

    if (!id) return badRequest("Missing id");
    if (!deviceId) return badRequest("Missing deviceId");
    if (!name) return badRequest("Missing name");

    const ref = getAdminDb().collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ((snap.data()?.deviceId as string) !== deviceId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await ref.update({ name, updatedAt: Date.now() });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/recipes error:", error);
    return NextResponse.json({ error: "Failed to rename recipe" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id")?.trim();
    const deviceId = req.nextUrl.searchParams.get("deviceId")?.trim();

    if (!id) return badRequest("Missing id");
    if (!deviceId) return badRequest("Missing deviceId");

    const ref = getAdminDb().collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ((snap.data()?.deviceId as string) !== deviceId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/recipes error:", error);
    return NextResponse.json({ error: "Failed to remove recipe" }, { status: 500 });
  }
}
