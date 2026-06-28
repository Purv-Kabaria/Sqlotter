import os
import json
from PIL import Image, ImageDraw, ImageFont

def build_tree(root_dir):
    """Recursively builds a tree structure of the assets directory using relative paths."""
    tree = {"name": os.path.basename(root_dir), "rel_path": root_dir, "dirs": {}, "images": []}
    try:
        for entry in os.scandir(root_dir):
            if entry.is_dir():
                sub_tree = build_tree(entry.path)
                # Only include sub-folders if they contain images
                if sub_tree["images"] or sub_tree["dirs"]:
                    tree["dirs"][entry.name] = sub_tree
            elif entry.is_file() and entry.name.lower().endswith(('.png', '.jpg', '.jpeg', '.bmp', '.gif')):
                try:
                    # Get original dimensions safely without keeping file open
                    with Image.open(entry.path) as img:
                        orig_w, orig_h = img.width, img.height
                except:
                    orig_w, orig_h = 0, 0
                
                tree["images"].append({
                    "path": entry.path.replace("\\", "/"),
                    "name": entry.name,
                    "w": orig_w,
                    "h": orig_h
                })
    except Exception as e:
        print(f"Error scanning {root_dir}: {e}")
    return tree

def generate_html_output(tree, output_path="assets_catalog.html"):
    """Generates an HTML file with an accurate relative path tree layout and image sizes."""
    
    def serialize_tree(node):
        return {
            "name": node["name"],
            "images": node["images"], 
            "dirs": {k: serialize_tree(v) for k, v in node["dirs"].items()}
        }
    
    tree_json = json.dumps(serialize_tree(tree), indent=2)

    html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Pixel Art Asset Tree</title>
    <style>
        body {{
            background-color: #1a1a1a;
            color: #e0e0e0;
            font-family: 'Courier New', Courier, monospace;
            margin: 30px;
        }}
        h1 {{
            color: #00ffcc;
            border-bottom: 2px solid #333;
            padding-bottom: 10px;
        }}
        .folder {{
            margin: 15px 0 15px 20px;
            padding-left: 15px;
            border-left: 2px dashed #444;
        }}
        .folder-title {{
            font-weight: bold;
            color: #ffcc00;
            margin-bottom: 10px;
            font-size: 16px;
        }}
        .asset-grid {{
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            margin-bottom: 10px;
        }}
        .asset-card {{
            background: #222;
            border: 1px solid #3c3c3c;
            border-radius: 4px;
            padding: 8px;
            text-align: center;
        }}
        .asset-card img {{
            image-rendering: pixelated;
            image-rendering: crisp-edges;
            max-height: 256px; 
            display: block;
            margin: 0 auto 8px auto;
        }}
        .asset-name {{
            font-size: 11px;
            color: #bbb;
            word-break: break-all;
            max-width: 150px;
            margin-bottom: 2px;
        }}
        .asset-size {{
            font-size: 9px;
            color: #666;
            font-weight: bold;
        }}
    </style>
</head>
<body>

    <h1>👾 Pixel Art Asset Tree (4x Scale)</h1>
    <div id="tree-root"></div>

    <script>
        const treeData = {tree_json};

        function renderTree(node, container) {{
            const folderDiv = document.createElement('div');
            folderDiv.className = 'folder';

            const title = document.createElement('div');
            title.className = 'folder-title';
            title.textContent = "📁 " + node.name;
            folderDiv.appendChild(title);

            if (node.images.length > 0) {{
                const grid = document.createElement('div');
                grid.className = 'asset-grid';
                
                node.images.forEach(img => {{
                    const card = document.createElement('div');
                    card.className = 'asset-card';
                    
                    const image = document.createElement('img');
                    image.src = img.path; 
                    
                    image.onload = function() {{
                        this.width = this.naturalWidth * 4;
                        this.height = this.naturalHeight * 4;
                    }};

                    const name = document.createElement('div');
                    name.className = 'asset-name';
                    name.textContent = img.name;

                    const sizeLabel = document.createElement('div');
                    sizeLabel.className = 'asset-size';
                    sizeLabel.textContent = img.w + "x" + img.h;

                    card.appendChild(image);
                    card.appendChild(name);
                    card.appendChild(sizeLabel);
                    grid.appendChild(card);
                }});
                folderDiv.appendChild(grid);
            }}

            for (const key in node.dirs) {{
                renderTree(node.dirs[key], folderDiv);
            }}

            container.appendChild(folderDiv);
        }}

        renderTree(treeData, document.getElementById('tree-root'));
    </script>
</body>
</html>
"""
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html_template)
    print(f"✔️ Generated HTML: {output_path}")

def generate_static_images(tree, scale_factor=4, output_png="assets_catalog.png", output_pdf="assets_catalog.pdf"):
    """Generates a visual hierarchy layout using Pillow scaled by 4x with size labels."""
    items_to_draw = []
    
    def flatten_tree(node, depth=0):
        items_to_draw.append(("folder", node["name"], depth))
        if node["images"]:
            items_to_draw.append(("images", node["images"], depth + 1))
        for sub_dir in node["dirs"].values():
            flatten_tree(sub_dir, depth + 1)

    flatten_tree(tree)
    
    canvas_width = 1600
    current_y = 50
    line_height = 40
    padding = 20
    text_cushion = 48 # space for text name + size string underneath
    
    calculated_positions = []
    
    for item_type, content, depth in items_to_draw:
        indent = (depth * 35) + 30
        if item_type == "folder":
            calculated_positions.append(("folder", content, indent, current_y, 0))
            current_y += line_height
        elif item_type == "images":
            x_curr = indent
            row_height = 0
            image_group = []
            
            for img in content:
                w, h = (img["w"] if img["w"] > 0 else 32), (img["h"] if img["h"] > 0 else 32)
                scaled_w, scaled_h = w * scale_factor, h * scale_factor
                
                card_w = max(scaled_w + 16, 100) # Give minimal width for tiny files text tracking
                card_h = scaled_h + text_cushion
                
                if x_curr + card_w > canvas_width - 30:
                    x_curr = indent
                    current_y += row_height + padding
                    row_height = 0
                
                image_group.append((img, x_curr, current_y, card_w, card_h, scaled_w, scaled_h))
                row_height = max(row_height, card_h)
                x_curr += card_w + padding
                
            calculated_positions.append(("images", image_group, 0, 0, 0))
            current_y += row_height + padding

    # Build image canvas
    img_out = Image.new("RGB", (canvas_width, current_y + 100), "#1a1a1a")
    draw = ImageDraw.Draw(img_out)
    
    try:
        font = ImageFont.load_default()
    except:
        font = None

    # Render pass
    for item in calculated_positions:
        itype = item[0]
        if itype == "folder":
            _, name, indent, y, _ = item
            if indent > 30:
                draw.line([(indent - 25, y + 10), (indent - 5, y + 10)], fill="#444444", width=2)
            draw.text((indent, y), f"📁 {name}", fill="#ffcc00", font=font)
        elif itype == "images":
            for img_obj, x, y, cw, ch, iw, ih in item[1]:
                # Draw card background
                draw.rectangle([x, y, x + cw, y + ch], outline="#3c3c3c", fill="#222222")
                
                # Center the scaled image inside card width horizontally if width card is larger
                img_x_offset = (cw - iw) // 2
                
                try:
                    with Image.open(img_obj["path"]) as asset_img:
                        scaled_img = asset_img.resize((iw, ih), Image.Resampling.NEAREST)
                        img_out.paste(scaled_img, (x + img_x_offset, y + 8))
                except:
                    draw.rectangle([x + img_x_offset, y + 8, x + img_x_offset + iw, y + 8 + ih], fill="#333333")
                
                # File Name Label
                fname = img_obj["name"]
                if len(fname) > 18: fname = fname[:15] + "..."
                draw.text((x + 8, y + ih + 12), fname, fill="#bbbbbb", font=font)
                
                # Original Dimension Text Label
                size_str = f"{img_obj['w']}x{img_obj['h']}"
                draw.text((x + 8, y + ih + 28), size_str, fill="#555555", font=font)

    # Export
    img_out.save(output_png)
    print(f"✔️ Generated PNG: {output_png}")
    img_out.save(output_pdf, "PDF", resolution=100.0)
    print(f"✔️ Generated PDF: {output_pdf}")

if __name__ == "__main__":
    target_folder = "assets"
    if not os.path.exists(target_folder):
        print(f"Could not find absolute/relative folder called '{target_folder}'. Creating layout template...")
        os.makedirs(f"{target_folder}/sample_hero")
    else:
        assets_tree = build_tree(target_folder)
        generate_html_output(assets_tree)
        generate_static_images(assets_tree, scale_factor=4)