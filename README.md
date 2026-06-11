# Fight of the Sumo Hoppers

A small static browser game. It can be deployed directly to GitHub Pages without a build step.

## Run locally

Serve the folder with any static file server:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. In GitHub, open the repository settings.
3. Go to **Pages**.
4. Set **Build and deployment** to **GitHub Actions**.
5. Push to the `main` branch, or run the `Deploy GitHub Pages` workflow manually.

The site uses relative asset paths, so it works both at a user/organization Pages URL and at a project URL like `https://USER.github.io/sumo-hoppers/`.

After the repository is set up, publish changes with:

```sh
scripts/publish.sh -m "Describe the change"
```

The script commits local changes, pushes `main`, waits for the Pages workflow, and verifies the published URL.
