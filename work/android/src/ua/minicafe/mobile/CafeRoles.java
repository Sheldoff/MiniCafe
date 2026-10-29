package ua.minicafe.mobile;

public final class CafeRoles {
  public static final String[] KEYS = {"admin", "service", "cash", "bar", "delivery"};
  public static final String[] LABELS = {
    "Повний доступ", "Видача", "Тільки каса", "Тільки бариста", "Тільки видача їжі"
  };
  public static final String[] VIEWS = {"cash", "cash", "cash", "bar", "delivery"};

  public static int index(String role) {
    for (int i = 0; i < KEYS.length; i++) if (KEYS[i].equals(role)) return i;
    return 1;
  }

  public static int legacy(int old) {
    return old == 1 ? 2 : old == 2 ? 4 : 3;
  }
}
