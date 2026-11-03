# ZeControl Android

Coque native autour de la production (`https://zecontrol.vercel.app`), avec un
moteur de rappels de pointage qui fonctionne sur le téléphone, y compris sans
réseau. Aucun Firebase, aucune migration et aucun redéploiement ne sont requis.

## Fonctionnement

| Élément | Rôle |
| --- | --- |
| `MainActivity` | WebView du site, permissions, position, exports, hors connexion |
| `assets/native-bridge.js` | Relie les API web de notification de la WebView au moteur natif |
| `ReminderEngine` | Portage de `currentWorkPolicyReminder`, plus les services de nuit et les départs oubliés |
| `ReminderController` | Synchronisation, livraison sans doublon et programmation de l’alarme |
| `ReminderSyncWorker` | Rafraîchissement toutes les 30 min, filet de sécurité si une alarme est perdue |
| `SystemEventsReceiver` | Restaure les alarmes après un redémarrage, une mise à jour ou un changement d’heure |

Le téléphone garde 17 jours de règles résolues et les derniers pointages. Chaque
rappel a sa propre alarme exacte. Au déclenchement, l’application tente de
relire les données, puis décide localement : sans réseau, le rappel part quand
même d’après la dernière copie connue.

La session reste dans les cookies de la WebView et les jetons ne sont jamais
copiés ailleurs. Une session expirée en arrière-plan est renouvelée par le proxy
du site (`Set-Cookie`), seulement quand un rappel approche, et jamais pendant que
la page est à l’écran.

## Construire

Prérequis : JDK 17, SDK Android (plateforme 35) et le fichier `../.env`.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
./gradlew testDebugUnitTest assembleRelease
```

Le résultat est dans `app/build/outputs/apk/release/app-release.apk`.

La clé de signature est hors du dépôt, dans `~/.zecontrol-android/`. **Sauvegardez
ce dossier en lieu sûr** : sans cette clé, les téléphones ne pourront plus
installer de mise à jour sans désinstaller l’application.

Avant chaque nouvelle version, augmentez `versionCode` dans `app/build.gradle.kts`.

## Garder le moteur aligné sur le site

Après toute modification de `lib/work-policy-evaluation.ts` :

```bash
bun tools/generate-reminder-fixtures.ts
./gradlew testDebugUnitTest
```

`ReminderParityTest` compare alors les deux moteurs minute par minute. Un écart
signifie que `ReminderEngine.kt` doit être mis à jour.

## Publication sur le Play Store

`USE_EXACT_ALARM` et `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` sont adaptés à une
installation directe de l’APK. Google Play limite ces deux permissions : il
faudra les justifier ou les retirer avant une publication sur le Store.
