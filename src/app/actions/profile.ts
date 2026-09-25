"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { removeAvatar, saveAvatar } from "@/lib/profile/avatar";
import { act } from "./_util";

/** Any signed-in user (including accounts still waiting for approval) may set their own picture. */
export async function setAvatarAction(dataUrl: string) {
  return act(async () => {
    const user = await getSessionUser();
    if (!user) throw new Error("ابتدا وارد شوید");
    const url = await saveAvatar(user.id, dataUrl);
    revalidatePath("/", "layout");
    return { url };
  });
}

export async function removeAvatarAction() {
  return act(async () => {
    const user = await getSessionUser();
    if (!user) throw new Error("ابتدا وارد شوید");
    await removeAvatar(user.id);
    revalidatePath("/", "layout");
    return null;
  });
}
