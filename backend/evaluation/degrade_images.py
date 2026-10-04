"""
Fabrique des versions « photo de terrain » des pages synthétiques (les images fournies sont des rendus propres,
alors que la consigne annonce flou, ombres, inclinaison et faible lumière).

Les originaux ne sont pas modifiés (exigence du défi) : les copies dégradées vont dans data/degraded/,
sous le même nom de page, donc la vérité terrain s'applique telle quelle.

    python -m evaluation.degrade_images            # toutes les pages, dégradation moyenne
    python -m evaluation.degrade_images --strength 2
"""
import argparse
import random
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from evaluation.evaluate import default_images_dir, find_page_image  # noqa: E402
from evaluation.ground_truth import data_dir  # noqa: E402

degraded_dir = data_dir / 'degraded'


def add_shadow(page_image: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    """Ombre en dégradé (téléphone ou main au-dessus de la page)."""
    width, height = page_image.size
    gradient = Image.linear_gradient('L').resize((width, height))
    if rng.random() < 0.5:
        gradient = gradient.transpose(Image.Transpose.ROTATE_90).resize((width, height))
    darkness = int(110 * strength)
    shadow_mask = gradient.point(lambda value: int(value * darkness / 255))
    return Image.composite(Image.new('RGB', (width, height), 'black'), page_image, shadow_mask)


def degrade(page_image: Image.Image, rng: random.Random, strength: float) -> Image.Image:
    page_image = page_image.convert('RGB')
    # Inclinaison
    page_image = page_image.rotate(rng.uniform(-4, 4) * strength, expand=True, fillcolor=(60, 60, 60))
    # Faible lumière et contraste réduit
    page_image = ImageEnhance.Brightness(page_image).enhance(1 - rng.uniform(0.1, 0.3) * strength)
    page_image = ImageEnhance.Contrast(page_image).enhance(1 - rng.uniform(0.05, 0.25) * strength)
    page_image = add_shadow(page_image, rng, rng.uniform(0.3, 0.8) * min(strength, 1.5))
    # Flou de bougé / mise au point
    page_image = page_image.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.8, 1.8) * strength))
    # Bruit de capteur
    noise = Image.effect_noise(page_image.size, 18 * strength).convert('RGB')
    page_image = Image.blend(page_image, noise, 0.06 * strength)
    # Résolution d'un téléphone moyen
    scale = 0.6 if strength >= 1 else 0.8
    return page_image.resize((int(page_image.width * scale), int(page_image.height * scale)))


def main() -> None:
    parser = argparse.ArgumentParser(description='Crée des copies dégradées des pages synthétiques.')
    parser.add_argument('--strength', type=float, default=1.0, help='0.5 = léger, 1 = moyen, 2 = fort')
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()

    degraded_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    count = 0
    for page_number in range(1, 81):
        source_path = find_page_image(default_images_dir, page_number)
        if source_path is None:
            continue
        with Image.open(source_path) as page_image:
            degraded = degrade(page_image, rng, args.strength)
        degraded.save(degraded_dir / f'dossiers_specimen_10_patientes-{page_number:02d}.jpg', quality=int(55 - 10 * args.strength))
        count += 1
    print(f'{count} pages dégradées écrites dans {degraded_dir}')


if __name__ == '__main__':
    main()
