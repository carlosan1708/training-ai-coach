# Desarrollo local

Ejecutá los comandos desde la raíz del repositorio. Usá Node.js 22.12 o superior de la rama 22.

## Demo en el navegador

```sh
npm ci --prefix web
npm run dev --prefix web -- --host 127.0.0.1
```

Abrí la URL que imprime Vite y elegí **Probar la demo**. Las rutinas, los entrenamientos, las mediciones y las respuestas simuladas usan datos de ejemplo en el navegador. Para la demo solo necesitás Node.js.

## App conectada a los emuladores de Firebase

Esta opción usa Auth, Firestore, Storage y Functions en tu máquina con el proyecto ficticio `demo-training-coach`. Las funciones usan respuestas de IA simuladas y omiten el envío de correo. Instalá Python 3.12 y Java 21 o superior, y asegurate de que `java -version` funcione en la terminal.

### 1. Prepará las dependencias y la configuración

PowerShell:

```powershell
npm ci --prefix web
python -m venv functions/venv
.\functions\venv\Scripts\python.exe -m pip install -r functions/requirements.txt
npm install --global firebase-tools@15.13.0

if (!(Test-Path web/.env.emulator.local)) { Copy-Item web/.env.emulator.local.example web/.env.emulator.local }
if (!(Test-Path functions/.env.local)) { Copy-Item functions/.env.local.example functions/.env.local }
if (!(Test-Path functions/.secret.local)) { Copy-Item functions/.secret.local.example functions/.secret.local }
```

En macOS/Linux, usá `python3.12 -m venv functions/venv` y `functions/venv/bin/python -m pip install -r functions/requirements.txt`. Para cada plantilla, usá `cp -n origen destino` con los mismos nombres de archivo.

Si ya tenés esos archivos locales, revisá que usen los valores de los ejemplos. Si tu terminal exporta variables `VITE_*`, retiralas de esa sesión para que no tengan precedencia sobre el archivo del modo emulador.

### 2. Iniciá el backend y el frontend

Terminal 1:

```sh
firebase emulators:start --config firebase.emulators.json --project demo-training-coach --only "auth,firestore,storage,functions"
```

Esperá a que Firebase muestre los cuatro emuladores listos. Auth usa el puerto 9099, Firestore el 8085, Storage el 9199 y Functions el 5001. La interfaz del emulador queda en `http://127.0.0.1:4000`.

Terminal 2:

```sh
npm run dev --prefix web -- --mode emulator --host 127.0.0.1 --port 5173 --strictPort
```

Abrí `http://127.0.0.1:5173`. Vite carga `web/.env.emulator.local` en este modo.

### 3. Entrá con una cuenta de prueba

Con los emuladores listos, ejecutá en otra terminal desde la raíz:

```sh
npm run local:accounts
```

En la app, elegí **Continuar con Google** y seleccioná una de las [cuentas de desarrollo del README](../README.md#run-locally) en el diálogo del emulador. Podés entrar sin contraseña. Usá **Local Developer** para administración y **Local Athlete 1, 2 o 3** para probar el acceso normal. Completá el perfil en el primer ingreso.

Volvé a ejecutar el comando si reiniciás los emuladores con una base vacía. Si ya existen las cuentas, el comando conserva los documentos de acceso existentes y los datos de entrenamiento. Para cambiar de cuenta, cerrá sesión en la app y seleccioná otra en el diálogo.

El emulador de Firestore rechaza algunas consultas descendentes por ID que usan el chat y el historial de mediciones. Para explorar esos flujos en local, usá la demo del navegador.

Los datos de los emuladores duran hasta que los detenés. Si querés conservar datos de prueba, podés exportarlos a la carpeta ignorada `.qa/`. [Exportación e importación de emuladores](https://firebase.google.com/docs/emulator-suite/install_and_configure#import_and_export_data).

## Variables de entorno y secretos

| Archivo | Uso |
| --- | --- |
| `web/.env.emulator.local` | Configuración pública de Firebase para Vite en modo emulador. |
| `web/.env.local` | Configuración pública de Vite para el desarrollo normal, si necesitás conectarte a un proyecto Firebase. Toda variable `VITE_*` puede quedar en el JavaScript del navegador. |
| `functions/.env.local` | Parámetros locales de Functions, incluidos `APP_ENV=development` y `AI_MOCK_ENABLED=true`. |
| `functions/.env.<project-id>` | Parámetros de cada proyecto generados por los scripts de publicación, incluidos los identificadores de federación de OpenAI. |
| `functions/.secret.local` | Valores de prueba para `SMTP_USER` y `SMTP_PASSWORD`. Firebase lee los bindings `SecretParam` desde este archivo en el emulador. [Configuración del emulador de Functions](https://firebase.google.com/docs/emulator-suite/connect_functions#configure_a_local_testing_environment). |

Usá las plantillas `.example` con valores ficticios. El [archivo .gitignore](../.gitignore) excluye los archivos reales `.env*` y `.secret*`, manifiestos locales, llaves privadas comunes y artefactos de desarrollo. Podés comprobarlo con `git check-ignore -v web/.env.emulator.local functions/.secret.local`. Git sigue rastreando archivos ya versionados aunque coincidan con una regla nueva. [Firebase](../firebase.json) también excluye estos archivos de configuración y credenciales del paquete de Functions.

En QA y producción, Firebase obtiene las credenciales SMTP desde Secret Manager. OpenAI usa identidad federada con tokens de corta duración. [Configuración de OpenAI](OPENAI_SETUP.md) · [Configuración de QA](QA.md).

## Ejecutá las verificaciones locales

Detené los emuladores del paso anterior para liberar los puertos. Con las dependencias de Node, Python y Firebase CLI instaladas como se indicó arriba, ejecutá:

```sh
npx --prefix web playwright install chromium
npm run check
```

En Linux, usá `playwright install --with-deps chromium` en el primer comando si faltan las dependencias del sistema. `npm run check` ejecuta lint y build, pruebas de Python, las validaciones de entorno, las reglas de Firebase con emuladores y Playwright completo. Para ejecutar solo Playwright, usá `npm run test:playwright`.
